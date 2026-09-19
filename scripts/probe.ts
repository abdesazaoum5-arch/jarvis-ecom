import { probeEnvironment } from '../core/environment/probe.ts';

const report = await probeEnvironment();
console.log(JSON.stringify(report, null, 2));
