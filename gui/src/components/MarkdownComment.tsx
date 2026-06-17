import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

interface MarkdownCommentProps {
  content: string
}

export function MarkdownComment({ content }: MarkdownCommentProps) {
  const components = useMemo(
    () => ({
      p: ({ node: _node, ...props }) => <p className="cark-comment-p" {...props} />,
      ul: ({ node: _node, ...props }) => <ul className="cark-comment-list" {...props} />,
      ol: ({ node: _node, ...props }) => <ol className="cark-comment-list cark-comment-ordered" {...props} />,
      li: ({ node: _node, ...props }) => <li className="cark-comment-li" {...props} />,
      a: ({ node: _node, ...props }) => <a className="cark-comment-link" target="_blank" rel="noreferrer" {...props} />,
      blockquote: ({ node: _node, ...props }) => <blockquote className="cark-comment-quote" {...props} />,
      pre: ({ node: _node, ...props }) => <pre className="cark-comment-pre" {...props} />,
      code: ({ node: _node, className, ...props }) => (
        <code className={['cark-comment-code', className].filter(Boolean).join(' ')} {...props} />
      ),
      hr: ({ node: _node, ...props }) => <hr className="cark-comment-hr" {...props} />,
    }),
    [],
  )

  return (
    <div className="cark-comment-md cark-text text-sm leading-7">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: 'ignore' }]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
