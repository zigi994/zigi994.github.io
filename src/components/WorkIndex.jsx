import { useState } from 'react'

export function WorkIndex({ items }) {
  const [activeId, setActiveId] = useState(items[0]?.id)
  const activeItem = items.find((item) => item.id === activeId) ?? items[0]

  if (!activeItem) {
    return null
  }

  return (
    <section className="section container" id="work" aria-labelledby="work-title">
      <header className="section-heading">
        <h2 id="work-title">作品目录</h2>
        <p>项目案例会从这里依次展开。</p>
      </header>

      <div className="work-layout">
        <ul className="work-list">
          {items.map((item) => {
            const isActive = item.id === activeItem.id

            return (
              <li className={isActive ? 'is-active' : ''} key={item.id}>
                <button
                  className="work-trigger"
                  type="button"
                  aria-pressed={isActive}
                  aria-controls="work-note"
                  onClick={() => setActiveId(item.id)}
                  onFocus={() => setActiveId(item.id)}
                  onMouseEnter={() => setActiveId(item.id)}
                >
                  <span className="work-title">{item.title}</span>
                  <span className="work-type">{item.type}</span>
                  <span className="work-status">{item.status}</span>
                </button>
              </li>
            )
          })}
        </ul>

        <aside
          className="work-note"
          id="work-note"
          aria-labelledby="work-note-title"
          aria-live="polite"
          aria-atomic="true"
        >
          <p className="note-label">当前批注</p>
          <h3 id="work-note-title">{activeItem.title}</h3>
          <p>{activeItem.note}</p>
          {activeItem.href ? (
            <a className="text-link note-link" href={activeItem.href}>
              阅读完整案例
            </a>
          ) : (
            <p className="note-state">尚未发布详情页</p>
          )}
        </aside>
      </div>
    </section>
  )
}
