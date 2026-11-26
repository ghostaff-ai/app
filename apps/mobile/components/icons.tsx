import type { IconProps, IconWeight } from 'phosphor-react-native';
import type { ComponentType } from 'react';
import { usePalette } from '@/lib/theme';

// Phosphor's line icons (app-design.md, decision 30), one file per icon so the
// app carries only the ones it draws: add an export here before using a new one.
// SF Symbols and Material Symbols stay inside the native tabs.

export { AppWindowIcon as AppWindow } from 'phosphor-react-native/src/icons/AppWindow';
export { ArrowDownIcon as ArrowDown } from 'phosphor-react-native/src/icons/ArrowDown';
export { ArrowsClockwiseIcon as ArrowsClockwise } from 'phosphor-react-native/src/icons/ArrowsClockwise';
export { ArrowUpIcon as ArrowUp } from 'phosphor-react-native/src/icons/ArrowUp';
export { BrainIcon as Brain } from 'phosphor-react-native/src/icons/Brain';
export { BuildingsIcon as Buildings } from 'phosphor-react-native/src/icons/Buildings';
export { CameraIcon as Camera } from 'phosphor-react-native/src/icons/Camera';
export { CaretDoubleDownIcon as CaretDoubleDown } from 'phosphor-react-native/src/icons/CaretDoubleDown';
export { CaretDownIcon as CaretDown } from 'phosphor-react-native/src/icons/CaretDown';
export { CaretLeftIcon as CaretLeft } from 'phosphor-react-native/src/icons/CaretLeft';
export { CaretRightIcon as CaretRight } from 'phosphor-react-native/src/icons/CaretRight';
export { CaretUpIcon as CaretUp } from 'phosphor-react-native/src/icons/CaretUp';
export { ChatsCircleIcon as ChatsCircle } from 'phosphor-react-native/src/icons/ChatsCircle';
export { CheckIcon as Check } from 'phosphor-react-native/src/icons/Check';
export { CheckCircleIcon as CheckCircle } from 'phosphor-react-native/src/icons/CheckCircle';
export { ChecksIcon as Checks } from 'phosphor-react-native/src/icons/Checks';
export { ClockIcon as Clock } from 'phosphor-react-native/src/icons/Clock';
export { EnvelopeSimpleIcon as EnvelopeSimple } from 'phosphor-react-native/src/icons/EnvelopeSimple';
export { EyeIcon as Eye } from 'phosphor-react-native/src/icons/Eye';
export { HandshakeIcon as Handshake } from 'phosphor-react-native/src/icons/Handshake';
export { LinkSimpleIcon as LinkSimple } from 'phosphor-react-native/src/icons/LinkSimple';
export { LockSimpleIcon as LockSimple } from 'phosphor-react-native/src/icons/LockSimple';
export { MagnifyingGlassIcon as MagnifyingGlass } from 'phosphor-react-native/src/icons/MagnifyingGlass';
export { MicrophoneIcon as Microphone } from 'phosphor-react-native/src/icons/Microphone';
export { PaperPlaneRightIcon as PaperPlaneRight } from 'phosphor-react-native/src/icons/PaperPlaneRight';
export { PauseIcon as Pause } from 'phosphor-react-native/src/icons/Pause';
export { PencilSimpleIcon as PencilSimple } from 'phosphor-react-native/src/icons/PencilSimple';
export { PhoneIcon as Phone } from 'phosphor-react-native/src/icons/Phone';
export { PlayIcon as Play } from 'phosphor-react-native/src/icons/Play';
export { PlusIcon as Plus } from 'phosphor-react-native/src/icons/Plus';
export { ProhibitIcon as Prohibit } from 'phosphor-react-native/src/icons/Prohibit';
export { SealCheckIcon as SealCheck } from 'phosphor-react-native/src/icons/SealCheck';
export { SignOutIcon as SignOut } from 'phosphor-react-native/src/icons/SignOut';
export { SparkleIcon as Sparkle } from 'phosphor-react-native/src/icons/Sparkle';
export { StopIcon as Stop } from 'phosphor-react-native/src/icons/Stop';
export { TrashIcon as Trash } from 'phosphor-react-native/src/icons/Trash';
export { TrayIcon as Tray } from 'phosphor-react-native/src/icons/Tray';
export { UserIcon as User } from 'phosphor-react-native/src/icons/User';
export { UserPlusIcon as UserPlus } from 'phosphor-react-native/src/icons/UserPlus';
export { UsersThreeIcon as UsersThree } from 'phosphor-react-native/src/icons/UsersThree';
export { WarningCircleIcon as WarningCircle } from 'phosphor-react-native/src/icons/WarningCircle';
export { XIcon as X } from 'phosphor-react-native/src/icons/X';
export { XCircleIcon as XCircle } from 'phosphor-react-native/src/icons/XCircle';

export type IconComponent = ComponentType<IconProps>;

/** An icon in the app's colours: ink, 22 points, Phosphor's light line. */
export function Icon({
  icon: I,
  size = 22,
  color,
  weight = 'light',
}: {
  icon: IconComponent;
  size?: number;
  color?: string;
  weight?: IconWeight;
}) {
  const c = usePalette();
  return <I size={size} color={color ?? c.ink} weight={weight} />;
}
