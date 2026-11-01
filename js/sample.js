/* A tiny built-in demo novel so users can try the tool without a file. */
(function (CS) {
  'use strict';
  const para = [
    'The rain had not stopped for three days, and the old city seemed to sink a little deeper into the mud with every hour.',
    'Arjun pulled his coat tighter and walked past the shuttered shops, counting the lamps as he went, the way his grandmother had taught him.',
    '"You are late," said a voice from the shadows. It was soft, almost amused, and it belonged to someone he had hoped never to meet again.',
    'He did not answer. Instead he looked up at the clock tower, whose hands had been frozen at a quarter past midnight for as long as anyone could remember.',
    'Somewhere far away a train whistle sounded, long and lonely, and the wind carried the smell of wet earth and burning cedar.',
    'Meera laughed, and for a moment the darkness felt less heavy. "Then we should hurry," she said, "before the river decides for us."'
  ];
  const body = n => Array.from({ length: 6 + (n % 4) }, (_, i) => para[(n + i) % para.length]).join('\n\n');
  const words = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
  const titles = ['The Frozen Clock', 'Rain Over Varanasi', 'A Voice in the Dark', 'The River Decides', 'Cedar Smoke', 'Lamps of the Old City',
    'The Last Train', 'What Meera Knew', 'Under the Bridge', 'Midnight Market', 'The Broken Seal', 'Dawn'];
  let out = 'THE CLOCKMAKER\'S CITY\nA Novel\n\nby Demo Author\n\nContents\nPrologue\n' +
    titles.map((t, i) => 'Chapter ' + (i + 1) + ': ' + t).join('\n') + '\nEpilogue\n\n\n';
  out += 'Prologue\n\n' + body(0) + '\n\n\n';
  titles.forEach((t, i) => {
    // mix heading styles to show off the detector
    const h = i % 3 === 0 ? 'Chapter ' + (i + 1) + ': ' + t
      : i % 3 === 1 ? 'CHAPTER ' + toRoman(i + 1) + '\n' + t
        : 'Chapter ' + words[i] + ' – ' + t;
    out += h + '\n\n' + body(i + 1) + '\n\n\n';
  });
  out += 'Epilogue\n\n' + body(20) + '\n';

  function toRoman(n) {
    const m = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = '';
    for (const [v, r] of m) while (n >= v) { s += r; n -= v; }
    return s;
  }
  CS.SAMPLE = { name: 'The Clockmakers City (sample).txt', text: out };
})(self.CS = self.CS || {});
