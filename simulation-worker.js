import { simulate } from './simulation.js?v=10';
import { prepareExport } from './export-profile.js?v=10';
self.onmessage = ({ data }) => {
  try { self.postMessage({ result: prepareExport(simulate(data.route, data.settings)) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
