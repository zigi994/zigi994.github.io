export function Hero({ role, lines, introduction }) {
  return (
    <section className="hero container" id="top" aria-labelledby="hero-title">
      <h1 id="hero-title">
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </h1>

      <div className="hero-context">
        <p className="hero-role">{role}</p>
        <p className="hero-introduction">{introduction}</p>
        <a className="text-link" href="#work">
          从作品目录开始
        </a>
      </div>
    </section>
  )
}
