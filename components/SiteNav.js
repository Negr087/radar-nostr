// The section links at the top of the radar and the pages around it. `active`: the href
// of the page it's on.

const LINKS = [
  ["/", "◉", "Live radar"],
  ["/state", "◎", "State of Nostr"],
  ["/flows", "⇆", "App flows"],
  ["/relays", "⌁", "Relays"],
  ["/compare", "⇄", "Compare apps"],
  ["/?tv", "▣", "TV mode"],
];

export default function SiteNav({ active }) {
  return (
    <nav className="site-nav" aria-label="Sections">
      {LINKS.map(([href, icon, label]) => (
        <a
          key={href}
          href={href}
          className={href === active ? "active" : undefined}
          aria-current={href === active ? "page" : undefined}
        >
          <span aria-hidden="true">{icon}</span> {label}
        </a>
      ))}
    </nav>
  );
}
