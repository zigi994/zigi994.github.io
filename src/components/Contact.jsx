export function Contact({ email, github }) {
  return (
    <section
      className="section contact-section container"
      id="contact"
      aria-labelledby="contact-title"
    >
      <header className="section-heading">
        <h2 id="contact-title">联系</h2>
        <p>从一个具体的问题聊起。</p>
      </header>

      <div className="contact-content">
        <p className="contact-prompt">如果你想一起做点什么，欢迎来找我。</p>
        <div className="contact-links">
          {email ? (
            <a href={`mailto:${email}`}>{email}</a>
          ) : (
            <span className="contact-pending">邮箱待补充</span>
          )}
          <a href={github} target="_blank" rel="noreferrer">
            <span translate="no">GitHub</span>
            <span className="sr-only">（在新窗口打开）</span>
          </a>
        </div>
      </div>
    </section>
  )
}
