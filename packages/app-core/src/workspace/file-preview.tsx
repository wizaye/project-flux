import { useEffect, useMemo } from "react";
import { Download, FileQuestion } from "lucide-react";

function dataUrl(data: ArrayBuffer, mimeType: string) {
  const bytes = new Uint8Array(data);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export function FilePreview({
  title,
  path,
  data,
  mimeType,
}: {
  title: string;
  path: string;
  data: ArrayBuffer;
  mimeType: string;
}) {
  const category = useMemo(() => mimeType.split("/", 1)[0], [mimeType]);
  const media = category === "image" || category === "audio" || category === "video";
  const url = useMemo(() => {
    if (media) return dataUrl(data, mimeType);
    return URL.createObjectURL(new Blob([data], { type: mimeType }));
  }, [data, media, mimeType]);

  useEffect(
    () => () => {
      if (!media) URL.revokeObjectURL(url);
    },
    [media, url]
  );

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background"
      aria-label={`File preview: ${title}`}
    >
      {category === "image" ? (
        <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-muted/30 p-6">
          {url ? (
            <img src={url} alt={title} className="max-h-full max-w-full object-contain shadow-sm" />
          ) : null}
        </div>
      ) : category === "audio" ? (
        <div className="grid min-h-0 flex-1 place-items-center p-8">
          {url ? <audio src={url} controls className="w-full max-w-xl" /> : null}
        </div>
      ) : category === "video" ? (
        <div className="grid min-h-0 flex-1 place-items-center bg-black p-4">
          {url ? <video src={url} controls className="max-h-full max-w-full" /> : null}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center p-8 text-center">
          <div className="flex max-w-md flex-col items-center gap-3">
            <FileQuestion className="size-10 text-muted-foreground" />
            <div>
              <p className="font-medium">Binary file</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">{path}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {mimeType} · {new Intl.NumberFormat().format(data.byteLength)} bytes
              </p>
            </div>
            {url ? (
              <a
                href={url}
                download={path.slice(path.lastIndexOf("/") + 1)}
                className="inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs hover:bg-accent"
              >
                <Download className="size-3.5" /> Download / open externally
              </a>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
