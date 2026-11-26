// Kunci (mutex) dalam memori untuk Durable Object.
// Kenapa perlu: DO hanya menahan permintaan lain semasa operasi storan sendiri. Bila kita
// "await fetch()" ke Sheets API, permintaan lain BOLEH masuk di tengah-tengah. Rantai promise ini
// memastikan setiap tugasan (semak slot -> tulis Sheet -> kemas kini indeks) berjalan satu demi satu.
export function createMutex() {
  let tail = Promise.resolve();
  let pending = 0;
  function run(fn) {
    pending++;
    const result = tail.then(() => fn());
    tail = result.then(
      () => {},
      () => {}
    ).finally(() => {
      pending--;
    });
    return result;
  }
  run.pending = () => pending;
  return run;
}
