import Link from "next/link";
import type { missedQuestions } from "@/modules/opportunities/missed";

type Missed = Awaited<ReturnType<typeof missedQuestions>>;

/**
 * Açık fırsat yokken neden yok olduğunu ve ne yapılabileceğini sade dille anlatır: ölçüm yoksa ölçüm, markanın
 * anılmadığı sorular varsa o sorular ve öne çıkan sitelerin rakip olarak onaylanması.
 */
export function NoOpportunityGuide({ data, competitorsHref, visibilityHref }: { data: Missed; competitorsHref: string; visibilityHref: string }) {
  if (data.answers === 0) {
    return <p className="text-sm text-text-secondary">Henüz ölçüm sonucu yok. İlk ölçüm tamamlanınca rakiplere kaybettiğiniz sorular burada listelenir.</p>;
  }
  return (
    <div className="flex flex-col gap-2 text-sm text-text-secondary">
      <p>
        <span className="font-medium text-text">Şu an açık fırsat yok:</span> ölçülen {data.questions} sorunun {data.mentionedQuestions} tanesinde markanız anılıyor ve onayladığınız rakiplerden geride değilsiniz.
      </p>
      {data.missedCount > 0 ? (
        <>
          <p>Markanızın hiç anılmadığı {data.missedCount} soru var:</p>
          <ul className="list-disc pl-5">
            {data.missed.map((m) => (
              <li key={m.text}>“{m.text}”</li>
            ))}
          </ul>
          {data.domains.length ? (
            <p>
              Bu sorularda en çok kaynak gösterilen siteler: {data.domains.map((d) => d.domain).join(", ")}. Bunlardan rakibiniz olanları{" "}
              <Link className="font-medium text-primary underline" href={competitorsHref}>rakip olarak onaylayın</Link>; sonraki ölçümde bu sorular fırsat olarak listelenir ve “AI ile iyileştir” ile içerik hazırlayabilirsiniz.
            </p>
          ) : null}
          <p>
            <Link className="text-primary underline" href={visibilityHref}>Yanıtları inceleyin</Link>
          </p>
        </>
      ) : null}
    </div>
  );
}
