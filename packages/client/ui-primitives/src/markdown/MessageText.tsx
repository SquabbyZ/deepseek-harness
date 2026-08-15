// MessageText is the literal-text primitive for user and steering content; assistant output uses MarkdownText.

export function MessageText({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap [word-break:break-word] [font-size:inherit] [line-height:inherit]">
      {text}
    </div>
  )
}
