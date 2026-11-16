import { APICallError, NoObjectGeneratedError, NoOutputGeneratedError } from 'ai';
import { PlanValidationError } from './requirements.ts';

export function errorKind(error: unknown) {
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
  if (error instanceof PlanValidationError) return 'plan_validation';
  if (NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) return 'structured_output';
  if (APICallError.isInstance(error)) return error.statusCode === 429 ? 'provider_busy' : error.isRetryable ? 'provider_transient' : 'provider_rejected';
  return 'internal';
}

export type Attempt = { stage: string; attempt: number; status: string; elapsedMs: number; reason?: string };
export async function withRecovery<T>(stage: string, task: (repair: boolean, feedback: string) => Promise<T>, signal: AbortSignal, attempts: Attempt[], delay = 300): Promise<T> {
  let feedback = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    signal.throwIfAborted();
    const start = Date.now();
    try {
      const result = await task(attempt > 1, feedback);
      attempts.push({ stage, attempt, status: 'ok', elapsedMs: Date.now() - start });
      return result;
    } catch (error) {
      const kind = signal.aborted ? errorKind(signal.reason) : errorKind(error);
      feedback = error instanceof PlanValidationError ? error.message : '';
      attempts.push({ stage, attempt, status: kind, elapsedMs: Date.now() - start, ...(feedback ? { reason: feedback } : {}) });
      // Do not log model output, prompts, photos, keys, or arbitrary exception text.
      console.warn('[prompt-plan]', { stage, attempt, kind });
      if (signal.aborted) throw signal.reason;
      if (attempt === 2 || !['structured_output', 'plan_validation', 'provider_busy', 'provider_transient'].includes(kind)) throw error;
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
        signal.addEventListener('abort', abort, { once: true });
      });
    }
  }
  throw new Error('unreachable');
}

export function generationError(error: unknown) {
  switch (errorKind(error)) {
    case 'timeout': return { status: 504, code: 'timeout', error: '기획 시간이 길어져 중단했어요. 입력과 기존 계획은 유지됩니다. 다시 제안받기를 눌러주세요.' };
    case 'cancelled': return { status: 499, code: 'cancelled', error: '요청을 취소했어요. 입력과 기존 계획은 유지됩니다.' };
    case 'provider_busy': return { status: 503, code: 'provider_busy', error: 'AI 서비스가 혼잡해요. 잠시 후 다시 시도해주세요. 입력은 유지됩니다.' };
    case 'provider_rejected': return { status: 503, code: 'provider_rejected', error: 'AI 연결 설정 또는 요청을 처리하지 못했어요. 입력은 유지됩니다. 잠시 후 다시 시도해주세요.' };
    case 'structured_output': case 'plan_validation': return { status: 502, code: 'plan_incomplete', error: '필수 요청을 모두 반영한 계획을 완성하지 못했어요. 입력은 유지됩니다. 다시 제안받기를 눌러주세요.' };
    default: return { status: 502, code: 'generation_failed', error: 'AI 계획을 완료하지 못했어요. 입력과 기존 계획은 유지됩니다. 잠시 후 다시 시도해주세요.' };
  }
}
