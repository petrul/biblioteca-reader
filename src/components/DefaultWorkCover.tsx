import React from 'react';
import { appAsset } from '../services/serversideApi';
import { coverThumbnailUrl, type CoverThumbnailWidth } from '../services/coverThumbnail';

interface DefaultWorkCoverProps {
  title: string;
  author: string;
  className?: string;
}

/** The archived Biblioteca brush-paper cover, used until enrichment finishes. */
export const DefaultWorkCover: React.FC<DefaultWorkCoverProps> = ({ title, author, className = '' }) => (
  <div
    className={`relative overflow-hidden bg-[#e7e3dc] ${className}`}
    role="img"
    aria-label={`Default cover for ${title} by ${author}`}
  >
    <img src={appAsset('cover-blue.jpg')} alt="" aria-hidden="true" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} className="absolute inset-0 h-full w-full object-cover" />
    <div className="absolute inset-0 bg-linear-to-b from-white/20 via-transparent to-[#061f3e]/35" />
    <div className="absolute inset-x-0 top-0 p-3 sm:p-4 text-[#071c34] drop-shadow-[0_1px_1px_rgba(255,255,255,.65)]">
      <div className="font-serif-reading text-[clamp(0.85rem,2vw,1.25rem)] font-semibold leading-tight line-clamp-4">{title}</div>
      <div className="mt-1 font-serif-reading text-[clamp(0.65rem,1.4vw,0.9rem)] italic leading-tight line-clamp-2">{author}</div>
    </div>
    <div className="absolute inset-x-0 bottom-0 p-2 text-center text-[0.48rem] font-semibold uppercase tracking-[0.22em] text-white/80">Biblioteca</div>
  </div>
);

interface WorkCoverImageProps {
  src?: string;
  thumbnailWidth?: CoverThumbnailWidth;
  title: string;
  author: string;
  /** Sizing for both the image and the fallback, e.g. "h-full w-full". */
  className?: string;
  /** Extra classes for the <img> only (object-fit, hover effects). */
  imgClassName?: string;
  alt?: string;
}

/**
 * A work's cover, or DefaultWorkCover - the one fallback, both when the work
 * has no cover yet and when its cover URL fails to load (a deleted MinIO
 * object, an unreachable host). Tracks the failed URL rather than a boolean,
 * so a newly supplied cover is tried again.
 */
export const WorkCoverImage: React.FC<WorkCoverImageProps> = ({ src, title, author, className = '', imgClassName = 'object-cover object-center', alt, thumbnailWidth = 320 }) => {
  const [failedSource, setFailedSource] = React.useState<string>();
  const imageSource = coverThumbnailUrl(src, thumbnailWidth);
  if (!imageSource || imageSource === failedSource) {
    return <DefaultWorkCover title={title} author={author} className={className} />;
  }
  return (
    <img
      key={imageSource}
      src={imageSource}
      alt={alt ?? `Cover of ${title}`}
      referrerPolicy="no-referrer"
      className={`${className} ${imgClassName}`}
      onError={() => setFailedSource(imageSource)}
    />
  );
};
