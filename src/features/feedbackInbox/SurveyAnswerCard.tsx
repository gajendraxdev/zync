import type { InboxAnswer } from "./protocol";

/** Display the user's survey answers without exposing submission metadata. */
export function SurveyAnswerCard({ answers }: { answers: InboxAnswer[] }) {
  return (
    <dl className="space-y-2.5">
      {answers.map((answer, index) => (
        <div key={`${answer.label}-${index}`} className="min-w-0">
          <dt className="text-[11px] text-app-muted">{answer.label}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm">{answer.value}</dd>
        </div>
      ))}
    </dl>
  );
}
