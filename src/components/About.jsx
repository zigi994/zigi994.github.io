export function About({ paragraphs }) {
  return (
    <section className="section container" id="about" aria-labelledby="about-title">
      <header className="section-heading">
        <h2 id="about-title">关于</h2>
        <p>设计从理解开始。</p>
      </header>

      <div className="about-copy">
        {paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </section>
  )
}
