/* eslint-disable @next/next/no-img-element */
import { validRegionBox, type RegionBox } from '@/lib/capture/navigation';
import s from './orbit.module.css';

// The overlay and the uncropped image share the same box. Never attach stale coordinates to live video.
export function MarkedPhoto({ image, box, alt }: { image: string; box?: RegionBox | null; alt: string }) {
 const region=validRegionBox(box);
 return <div className={s.markedPhoto}><img src={image} alt={alt}/>{region&&<span className={s.regionBox} role="img" aria-label="보충이 필요한 부분 (AI 추정)" style={{left:`${region.x*100}%`,top:`${region.y*100}%`,width:`${region.width*100}%`,height:`${region.height*100}%`}}/>}</div>;
}
