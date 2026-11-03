// No serial API: both streams belong to the synthetic main-thread peer.
self.onmessage = async ({data}) => {
  const {readable, writable, signals, mode, timeoutMs} = data;
  const stamp = () => performance.timeOrigin + performance.now();
  const marks = {workerStarted: stamp()};
  const reader = readable.getReader(), writer = writable.getWriter();
  const read = async () => {
    let result = '';
    while (!result.includes('\n')) {const next = await reader.read(); if(next.done) throw new Error('peer closed'); result += new TextDecoder().decode(next.value);}
    return result.trim();
  };
  try {
    // Same final idle and matching native endpoint sequence for every mode.
    await writer.write(new TextEncoder().encode('QG\r')); await read();
    await writer.write(new TextEncoder().encode('QS\r')); await read();
    marks.verifiedEndpoint = stamp();
    if (mode === 'coalesced') self.postMessage({kind:'batch',signals:[signals.at(-1)],posted:stamp()});
    else for(let offset=0;offset<signals.length;offset+=200) self.postMessage({kind:'batch',signals:signals.slice(offset,offset+200),posted:stamp()});
    marks.queryRequested = stamp();
    let timer;
    const deadline = new Promise((_,reject) => {timer=setTimeout(()=>{marks.timerFired=stamp();reject(new Error('synthetic QG reply deadline'));},timeoutMs);});
    try {
      await Promise.race([(async()=>{await writer.write(new TextEncoder().encode('QG\r'));marks.writeResolved=stamp();const reply=await read();marks.replyRead=stamp();return reply;})(),deadline]);
      clearTimeout(timer);
      self.postMessage({kind:'done', outcome:'reply', marks});
    } catch(error) {self.postMessage({kind:'done',outcome:'timeout',closeReason:String(error),marks});}
  } catch(error) {self.postMessage({kind:'done',outcome:'error',closeReason:String(error),marks});}
};
