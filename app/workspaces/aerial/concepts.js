// Two ideas that are NOT built, drawn so the idea is clear. Both are labelled Concept.
const thermal = '<svg viewBox="0 0 300 96" role="img" aria-label="Diagram: the same patch of ground seen by a colour camera, where a person in earth-tone clothing is hard to see, and by a thermal camera, where the warm body stands out.">' +
  '<defs><radialGradient id="aerial-hot" cx="50%" cy="50%" r="50%"><stop offset="0" class="ac-h5"/><stop offset="0.35" class="ac-h4"/><stop offset="0.7" class="ac-h3"/><stop offset="1" class="ac-h2" stop-opacity="0"/></radialGradient></defs>' +
  // drone
  '<g class="ac-line"><path d="M132 13h36M138 13v-4M162 13v-4M131 9h14M155 9h14"/><rect x="143" y="13" width="14" height="7" rx="2" class="ac-fill"/><circle cx="147" cy="22" r="2.2"/><circle cx="153" cy="22" r="2.2"/></g>' +
  '<path d="M147 24 L22 44 H128 Z" class="ac-cone"/><path d="M153 24 L172 44 H278 Z" class="ac-cone ac-cone-hot"/>' +
  // colour tile
  '<rect x="22" y="44" width="106" height="46" rx="3" class="ac-mud"/><path d="M30 60q20-8 42 2t48-6M26 78q30-10 54 0t44-4" class="ac-mud-line"/><path d="M40 52l9 4-3 7-8-3zM92 70l12 2-2 9-11-3zM102 50l8 3-4 6z" class="ac-rock"/>' +
  '<g transform="translate(74 68) rotate(-24)" class="ac-body-mud"><rect x="-17" y="-5" width="24" height="10" rx="4"/><circle cx="12" cy="0" r="4.2"/><rect x="-30" y="-4.5" width="14" height="4" rx="2"/><rect x="-30" y="0.5" width="14" height="4" rx="2"/></g>' +
  // thermal tile
  '<rect x="172" y="44" width="106" height="46" rx="3" class="ac-cold"/><path d="M180 60q20-8 42 2t48-6M176 78q30-10 54 0t44-4" class="ac-cold-line"/>' +
  '<ellipse cx="222" cy="68" rx="30" ry="15" fill="url(#aerial-hot)" transform="rotate(-24 222 68)"/>' +
  '<g transform="translate(224 68) rotate(-24)" class="ac-body-hot"><rect x="-17" y="-5" width="24" height="10" rx="4"/><circle cx="12" cy="0" r="4.2"/><rect x="-30" y="-4.5" width="14" height="4" rx="2"/><rect x="-30" y="0.5" width="14" height="4" rx="2"/></g>' +
  '<text x="24" y="40" class="ac-text">Colour camera</text><text x="276" y="40" text-anchor="end" class="ac-text">Thermal camera</text></svg>';

const wifi = '<svg viewBox="0 0 300 96" role="img" aria-label="Diagram: a drone carrying a Wi-Fi transmitter hovers over a rubble pile; its signal crosses a void where a person lies and reaches the receiver on the rover on the other side.">' +
  '<path d="M0 88H300" class="ac-line"/>' +
  // rubble pile with a void
  '<path d="M70 88l14-30 22-14 30-10 34 6 26 20 18 28z" class="ac-rubble"/><path d="M96 66l18-8 10 9-14 9zM142 44l20 2 6 12-22 4zM168 62l22 4 6 14-24-2zM118 46l16-6 6 10-18 6z" class="ac-rock"/>' +
  '<path d="M112 88l8-13 34-5 22 6 8 12z" class="ac-void"/>' +
  '<g transform="translate(146 82)" class="ac-body-hot"><rect x="-14" y="-4" width="20" height="7" rx="3"/><circle cx="10" cy="-0.5" r="3.4"/><rect x="-25" y="-3" width="12" height="5.5" rx="2"/></g>' +
  // drone with transmitter
  '<g class="ac-line" transform="translate(52 16)"><path d="M-18 0h36M-12 0v-4M12 0v-4M-19-4h14M5-4h14"/><rect x="-7" y="0" width="14" height="7" rx="2" class="ac-fill"/><path d="M0 7v5"/><circle cx="0" cy="14" r="2.4" class="ac-tx"/></g>' +
  // rover with receiver
  '<g class="ac-line" transform="translate(258 78)"><rect x="-16" y="-8" width="32" height="10" rx="2" class="ac-fill"/><circle cx="-10" cy="5" r="4.6"/><circle cx="10" cy="5" r="4.6"/><path d="M-8-8v-9"/><circle cx="-8" cy="-19" r="2.4" class="ac-rx"/></g>' +
  // signal paths
  '<path d="M52 30 L146 80 L250 59" class="ac-ray ac-ray-main"/><path d="M52 30 L250 59" class="ac-ray"/><path d="M52 30 L120 72 L250 59" class="ac-ray"/><path d="M52 30 L176 76 L250 59" class="ac-ray"/>' +
  '<text x="72" y="13" class="ac-text">Transmitter, carried over</text><text x="296" y="48" text-anchor="end" class="ac-text">Receiver on HOUND</text><text x="146" y="60" text-anchor="middle" class="ac-text ac-text-dim">void</text></svg>';

export function conceptPanel({ h, realityTag }) {
  const card = (svg, title, text) => h('div.aerial-concept', null, h('div.aerial-concept-art', { html: svg }), h('div.aerial-concept-text', null, h('b', null, title), h('p', null, text)));
  return h('section.aerial-card.aerial-concepts', { 'aria-label': 'Two ideas not built yet' },
    h('div.aerial-card-head', null, h('h3', null, 'Two more uses of the same drone'), realityTag('concept')),
    h('div.aerial-concepts-body', null,
      card(thermal, 'A heat camera beside the colour one', 'Colour fails on earth-tone clothing and in shadow. A warm body against cold, wet mud does not care what it wears. It fails the other way round: on sun-warmed rubble at midday, and under more than a thin cover. Not built; HOUND\'s only thermal sensor is the rover\'s 32 by 24 pixel MLX90640.'),
      card(wifi, 'The drone as a flying Wi-Fi transmitter', 'HOUND\'s Wi-Fi sensing needs its transmitter on the far side of what it looks through. A drone could set it down beyond rubble nobody can cross, so the signal passes through the void. Not built, and it must land first: breathing changes the signal by under half a percent, and a hovering transmitter moves far more than that.')));
}
