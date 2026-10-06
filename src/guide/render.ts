// Renders the "Send a link instead" section as plain HTML. The build puts it
// straight into index.html (see vite.config.ts), so the whole guide reads
// fine with JavaScript off; picker.ts adds the sorting on top.
import type { Fact, Need, Service } from './types'
import { guideCopy, NEEDS } from './copy'
import { CHECKED_TEXT, LEFT_OUT, PICKS, SERVICES } from './services'

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// `**Share**` marks a label the visitor will see on screen.
const inline = (text: string) => escape(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

const svg = (path: string, extra = '') => `<svg class="send-icon"${extra} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`
const yesIcon = svg('m5 12.5 4.2 4.2L19 7')
const noIcon = svg('M7 12h10')
const arrowIcon = svg('M5 12h13m-5-5 5 5-5 5')
const outIcon = svg('M7 17 17 7M8 7h9v9')
const caretIcon = svg('m6 9 6 6 6-6')

const external = (url: string, label: string, className = '') => `<a${className ? ` class="${className}"` : ''} href="${escape(url)}" target="_blank" rel="noopener noreferrer">${inline(label)}${outIcon}<span class="sr-only"> (opens in a new tab)</span></a>`

function fact(need: Need, value: Fact): string {
  const column = NEEDS.find((item) => item.id === need)!
  return `<div class="svc-fact" data-need="${need}" data-yes="${value.yes}"><dt data-pd-type="metadata">${escape(column.column)}</dt><dd data-pd-type="body.small">${value.yes ? yesIcon : noIcon}<span>${inline(value.text)}</span></dd></div>`
}

function row(service: Service, rank: number): string {
  const has = NEEDS.filter(({ id }) => service.facts[id].yes).map(({ id }) => id)
  const picks = PICKS.filter((pick) => pick.service === service.id).map((pick) => pick.for)
  const ourPick = picks.includes('all')
  return `<li class="svc" id="svc-${service.id}" data-has="${has.join(' ')}" data-picks="${picks.join(' ')}" data-rank="${rank}">
  <article class="svc-card" aria-labelledby="svc-${service.id}-name">
    <div class="svc-id">
      <h4 class="svc-name" id="svc-${service.id}-name" data-pd-type="title.card">${escape(service.name)}${ourPick ? ' <em class="badge" data-svc-badge>Our pick</em>' : ' <em class="badge" data-svc-badge hidden></em>'}</h4>
      <p class="svc-line" data-pd-type="body.small">${inline(service.line)}</p>
    </div>
    <dl class="svc-facts">${NEEDS.map(({ id }) => fact(id, service.facts[id])).join('')}</dl>
    <details class="svc-how">
      <summary data-pd-type="label"><span>${escape(guideCopy.howSummary(service.name))}</span>${caretIcon}</summary>
      <div class="svc-how-body">
        <ol class="svc-steps" data-pd-type="body.default">${service.how.map((step) => `<li>${inline(step)}</li>`).join('')}</ol>
        ${service.watch.length ? `<div class="svc-watch"><p data-pd-type="metadata">${escape(guideCopy.watchTitle)}</p><ul data-pd-type="body.small">${service.watch.map((item) => `<li>${inline(item)}</li>`).join('')}</ul></div>` : ''}
        <p class="svc-sources" data-pd-type="body.small">${escape(guideCopy.checkedOn(CHECKED_TEXT))} ${service.sources.map((source) => external(source.url, source.label)).join(', ')}.</p>
        ${external(service.url, guideCopy.goTo(service.name), 'button button--small svc-go')}
      </div>
    </details>
  </article>
</li>`
}

export function renderSendGuide(): string {
  const byId = new Map(SERVICES.map((service) => [service.id, service]))
  const copy = guideCopy
  return `<section class="section send" id="send-a-link" aria-labelledby="send-title">
  <div class="send-top">
    <div class="section-head">
      <p class="eyebrow" data-pd-type="metadata">${escape(copy.eyebrow)}</p>
      <h2 id="send-title" data-pd-type="heading.section">${escape(copy.title)}</h2>
    </div>
    <div class="section-body">
      <p data-pd-type="lead.section">${inline(copy.lead)}</p>
      ${copy.body.map((paragraph) => `<p data-pd-type="body.reading">${inline(paragraph)}</p>`).join('\n      ')}
    </div>
  </div>

  <div class="send-picks">
    ${PICKS.map((pick) => {
      const service = byId.get(pick.service)!
      return `<article class="send-pick send-pick--${pick.for}">
      <p class="send-pick-for" data-pd-type="metadata">${escape(pick.label)}</p>
      <h3 data-pd-type="title.card">${escape(service.name)}</h3>
      <p data-pd-type="body.default">${inline(pick.why)}</p>
      <a class="send-pick-link" href="#svc-${service.id}" data-svc-open="${service.id}" data-pd-type="body.small">${escape(copy.pickLink)}${arrowIcon}</a>
    </article>`
    }).join('\n    ')}
  </div>

  <div class="send-compare">
    <div class="send-compare-head">
      <h3 data-pd-type="heading.subsection">${escape(copy.compareTitle)}</h3>
      <p data-pd-type="body.default">${inline(copy.compareIntro)}</p>
    </div>
    <div class="send-filter" data-send-filter hidden>
      <div class="send-filter-head">
        <p class="send-filter-label" id="send-filter-label" data-pd-type="metadata">${escape(copy.filterLabel)}</p>
        <button class="text-button send-clear" type="button" data-send-clear hidden data-pd-type="body.small">${escape(copy.clear)}</button>
      </div>
      <div class="send-chips" role="group" aria-labelledby="send-filter-label">
        ${NEEDS.map((need) => `<button class="send-chip" type="button" aria-pressed="false" data-need="${need.id}">${yesIcon}<span>${escape(need.chip)}</span></button>`).join('\n        ')}
      </div>
      <p class="send-result" data-send-result aria-live="polite" data-pd-type="body.small">${escape(copy.resultIdle)}</p>
    </div>
    <div class="svc-head" aria-hidden="true">
      <span data-pd-type="metadata">${escape(copy.serviceColumn)}</span>
      ${NEEDS.map((need) => `<span data-pd-type="metadata" data-need="${need.id}">${escape(need.column)}</span>`).join('')}
    </div>
    <ol class="svc-list">
${SERVICES.map((service, index) => row(service, index + 1)).join('\n')}
    </ol>
  </div>

  <div class="send-rules">
    <h3 data-pd-type="title.card">${escape(copy.rulesTitle)}</h3>
    <ol class="send-rule-list">
      ${copy.rules.map((rule) => `<li><strong data-pd-type="label">${inline(rule.title)}</strong><span data-pd-type="body.default">${inline(rule.body)}</span></li>`).join('\n      ')}
    </ol>
  </div>

  <p class="send-leftout" data-pd-type="body.small">${escape(copy.leftOut)} ${LEFT_OUT.map((item, index) => `${index === LEFT_OUT.length - 1 ? 'and ' : ''}${external(item.url, item.name)}, which ${escape(item.why)}`).join('; ')}.</p>
  <p class="send-fineprint" data-pd-type="body.small">${inline(copy.fineprint(CHECKED_TEXT))} <a href="mailto:hello@pitch.dog?subject=Email%20My%20Deck%20link%20guide">${escape(copy.fineprintLink)}</a></p>
</section>`
}
