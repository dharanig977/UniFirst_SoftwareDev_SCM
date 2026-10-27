export function StatusBadge({ text, tone }: { text: string; tone: 'neutral' | 'good' | 'warn' | 'bad' }) {
  return <span className={`badge badge-${tone}`}>{text}</span>
}
