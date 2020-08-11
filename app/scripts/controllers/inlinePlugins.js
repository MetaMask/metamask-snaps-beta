
const plugins = {
  foo: `
    console.log('Welcome to Flavortown.');
  `,
  infiniteLoop: `
    console.log('You are not in Flavortown.');
    let num = 0;
    let time;
    while (true) {
      if (num === 0) {
        time = Date.now();
      }
      if (num === (2e8 - 1)) {
        console.log('Ding, gratz.');
        console.log(console.log((Date.now() - time) / 1000))
      }
      num = (num + 1) % 2e8;
  `,
}

module.exports = function getInlinePlugin (name = 'foo') {
  if (!plugins[name]) {
    throw new Error('no such inline plugin')
  }
  return `(function () {\n${plugins[name]}\n})();`
}
