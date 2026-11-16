import Link from 'next/link';
import type { ReactNode } from 'react';
import s from './studio-nav.module.css';
export default function StudioNav({ active, action }: { active: 'capture' | 'prompt'; action?: ReactNode }) {
  return <header className={s.header}><Link className={s.brand} href="/" aria-label="FRAME Studio 홈"><svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M12 4H4v8m16-8h8v8M4 20v8h8m16-8v8h-8"/><path d="M12 12h8v8h-8z" strokeWidth="1.5"/></svg><span>FRAME<small>STUDIO</small></span></Link><nav aria-label="스튜디오 도구"><Link href="/capture" aria-current={active === 'capture' ? 'page' : undefined}><span>1</span>제품 촬영</Link><Link href="/prompt" aria-current={active === 'prompt' ? 'page' : undefined}><span>2</span>연출 기획</Link></nav><div className={s.action}>{action}</div></header>;
}
