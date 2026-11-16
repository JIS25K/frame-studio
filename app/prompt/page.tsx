import type { Metadata } from 'next';
import PromptStudio from './studio';

export const metadata: Metadata = {
  title: 'FRAME — 연출 기획',
  description: '제품 사진과 짧은 생각을 구체적인 촬영 계획으로 만드세요.',
  openGraph: { title: 'FRAME — 연출 기획', description: '생성 전에 함께 완성하는 제품 촬영 계획' },
};
export default function Page() { return <PromptStudio />; }
