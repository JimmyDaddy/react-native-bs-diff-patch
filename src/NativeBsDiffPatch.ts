import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  patch(oldFile: string, newFile: string, patchFile: string): Promise<number>;
  diff(oldFile: string, newFile: string, patchFile: string): Promise<number>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('BsDiffPatch');
