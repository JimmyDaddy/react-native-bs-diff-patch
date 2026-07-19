import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  patch(oldFile: string, newFile: string, patchFile: string): Promise<number>;
  diff(oldFile: string, newFile: string, patchFile: string): Promise<number>;
  startPatch(
    jobId: string,
    oldFile: string,
    newFile: string,
    patchFile: string,
    maxInputBytes: number,
    maxOutputBytes: number
  ): Promise<number>;
  startDiff(
    jobId: string,
    oldFile: string,
    newFile: string,
    patchFile: string,
    maxInputBytes: number,
    maxOutputBytes: number
  ): Promise<number>;
  cancel(jobId: string): Promise<boolean>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('BsDiffPatch');
