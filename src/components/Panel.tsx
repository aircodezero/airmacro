import type { ReactNode } from 'react'

interface PanelProps {
  title?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  labelledBy?: string
}

export function Panel({ title, meta, actions, children, className, bodyClassName, labelledBy }: PanelProps) {
  const hasHead = title != null || meta != null || actions != null
  return (
    <section className={className ? `panel ${className}` : 'panel'} aria-labelledby={labelledBy}>
      {hasHead && (
        <div className="panel-head">
          <div className="panel-title">
            {title != null && <h2 id={labelledBy}>{title}</h2>}
            {meta != null && <small>{meta}</small>}
          </div>
          {actions != null && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName ? `panel-body ${bodyClassName}` : 'panel-body'}>{children}</div>
    </section>
  )
}
