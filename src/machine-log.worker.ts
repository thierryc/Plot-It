import {compactMachineLog} from './machine-log';
self.onmessage = event => {
  try {self.postMessage({blob: new Blob([JSON.stringify(compactMachineLog(event.data))], {type: 'application/json'})});}
  catch(error) {self.postMessage({error: error instanceof Error ? error.message : String(error)});}
};
