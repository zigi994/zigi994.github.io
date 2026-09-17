export function Nav({ name, availability }) {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <a className="brand" href="#top" aria-label={`${name}，返回首页`}>
          {name}
        </a>

        <nav aria-label="主要导航">
          <ul className="nav-list">
            <li>
              <a href="#work">作品</a>
            </li>
            <li>
              <a href="#about">关于</a>
            </li>
            <li>
              <a href="#contact">联系</a>
            </li>
          </ul>
        </nav>

        <p className="availability">
          <span className="availability-dot" aria-hidden="true" />
          {availability}
        </p>
      </div>
    </header>
  )
}
