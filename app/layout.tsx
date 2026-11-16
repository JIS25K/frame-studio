import "./globals.css";
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' as const };
export const metadata={title:"FRAME · 연출 기획",description:"제품 사진과 짧은 요청으로 함께 구체화하는 촬영 연출"};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>;}
