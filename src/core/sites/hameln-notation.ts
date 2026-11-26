// https://syosetu.org/?fid=55&mode=readme_view
const paired =
  'b|i|s|u|ruby|rt|small|big|xsmall|xbig|center|right|left|link|ref|sup|sub|font|bgcolor|boxbgcolor|bordercolor|boxbordercolor|edge|opacity|blur|shake|vib|box|text|table|marquee|blink|fade|telop|speak'

export const hamelnTag = new RegExp(
  `《(?:/?(?:${paired})(?::[^《》\\n]+)?|hr|id:[A-Za-z0-9]+)》`,
  'gi',
)
const readingTag = new RegExp(`^(/?)(${paired})(?::[^《》\\n]+)?$`, 'i')

export function isHamelnTagReading(reading: string, after: string, knownSite: boolean) {
  const tag = readingTag.exec(reading)
  if (tag) return knownSite || tag[1] === '/' || after.includes(`《/${tag[2]}》`)
  return knownSite && /^(?:hr|id:[A-Za-z0-9]+)$/i.test(reading)
}
