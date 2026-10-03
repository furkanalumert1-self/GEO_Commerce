import { Fragment, type ReactNode } from "react";
import { placeholderRegex, type ActionContent } from "@/modules/actions/workflow";

/** Yer tutucuları "Eksik: …" etiketi olarak gösterir; markdown bağlantı/kalın işaretlerini sadeleştirir. */
function Inline({ text }: { text: string }) {
  const clean = text.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1").replace(/\*\*|__/g, "");
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of clean.matchAll(placeholderRegex())) {
    if (m.index! > last) out.push(clean.slice(last, m.index));
    const label = m[0].slice(1, -1).replace(/^(placeholder|eksik|todo|tbd|doldur)\s*:?\s*/i, "");
    out.push(
      <span key={m.index} className="mx-0.5 inline-flex items-center rounded-[8px] border border-dashed border-warning/50 bg-warning-soft px-1.5 text-[13px] font-semibold text-warning">
        Eksik: {label || "bilgi"}
      </span>,
    );
    last = m.index! + m[0].length;
  }
  if (last < clean.length) out.push(clean.slice(last));
  return <>{out.map((x, i) => <Fragment key={i}>{x}</Fragment>)}</>;
}

function Markdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`} className="my-2 list-disc space-y-1 pl-5">{list.map((l, i) => <li key={i}><Inline text={l} /></li>)}</ul>);
    list = [];
  };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { flush(); continue; }
    if (/^[-*•]\s+/.test(l)) { list.push(l.replace(/^[-*•]\s+/, "")); continue; }
    flush();
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    blocks.push(h ? <p key={blocks.length} className="mt-3 font-semibold"><Inline text={h[2]!} /></p> : <p key={blocks.length} className="my-2"><Inline text={l} /></p>);
  }
  flush();
  return <>{blocks}</>;
}

/** Müşteri için okunur önizleme: başlık, açıklama, bloklar, SSS. Teknik fark ayrı sekmededir. */
export function ContentPreview({ content }: { content: ActionContent }) {
  return (
    <article className="text-[15px] leading-relaxed">
      <p className="text-xs text-text-secondary">Sitenizde yaklaşık böyle görünecek (önizleme)</p>
      {content.title ? <h3 className="mt-2 text-xl font-semibold leading-snug"><Inline text={content.title} /></h3> : null}
      {content.metaDescription ? <p className="mt-1 text-sm text-text-secondary"><Inline text={content.metaDescription} /></p> : null}
      {content.bodyBlocks.map((b, i) => (
        <section key={i} className="mt-4">
          {b.heading ? <h4 className="text-base font-semibold">{b.heading}</h4> : null}
          <Markdown text={b.markdown} />
        </section>
      ))}
      {content.faq.length ? (
        <section className="mt-5">
          <h4 className="text-base font-semibold">Sık sorulan sorular</h4>
          <dl className="mt-2 space-y-3">
            {content.faq.map((f, i) => (
              <div key={i}><dt className="font-medium"><Inline text={f.q} /></dt><dd className="text-text-secondary"><Inline text={f.a} /></dd></div>
            ))}
          </dl>
        </section>
      ) : null}
    </article>
  );
}
