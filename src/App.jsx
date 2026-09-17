import { About } from './components/About'
import { Contact } from './components/Contact'
import { Hero } from './components/Hero'
import { Nav } from './components/Nav'
import { WorkIndex } from './components/WorkIndex'
import { site } from './data/site'
import { work } from './data/work'

export default function App() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>

      <Nav name={site.name} availability={site.availability} />

      <main id="main-content">
        <Hero
          role={site.role}
          lines={site.hero}
          introduction={site.introduction}
        />
        <WorkIndex items={work} />
        <About paragraphs={site.about} />
        <Contact email={site.contact.email} github={site.contact.github} />
      </main>

      <footer className="site-footer container">
        <p>© {new Date().getFullYear()} {site.name}</p>
        <p>设计与内容持续更新中</p>
      </footer>
    </>
  )
}
