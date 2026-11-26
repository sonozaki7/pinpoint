import {Img, OffthreadVideo, staticFile} from "remotion";
import type {ReactNode} from "react";

type Props = {
  src?: string;
  still?: string;
  startFrom?: number;
  playbackRate?: number;
  className?: string;
  chip?: string;
  children?: ReactNode;
  imageStyle?: React.CSSProperties;
  footageStyle?: React.CSSProperties;
  coverBottom?: boolean;
};

/**
 * One G2 lens: a minimal outline, a 2.25x nearest-neighbour video frame
 * (1296x648 from the 576x288 simulator capture), and a subtle green glow.
 */
export function Lens({
  src,
  still,
  startFrom = 0,
  playbackRate = 1,
  className = "",
  chip,
  children,
  imageStyle,
  footageStyle,
  coverBottom = false,
}: Props) {
  return (
    <div className={`ps-lens ${className}`}>
      {chip ? (
        <div className="ps-lens-chip">
          <span className="dot" />
          {chip}
        </div>
      ) : null}
      {src ? (
        <OffthreadVideo
          className="ps-lens-footage"
          src={staticFile(src)}
          startFrom={Math.round(startFrom * 30)}
          playbackRate={playbackRate}
          muted
          style={footageStyle}
        />
      ) : null}
      {still ? (
        <Img
          className="ps-lens-footage"
          src={staticFile(still)}
          style={{...imageStyle, ...footageStyle}}
        />
      ) : null}
      <div className="ps-lens-glare" />
      {coverBottom ? <div className="ps-cover-bottom" /> : null}
      {children}
    </div>
  );
}
