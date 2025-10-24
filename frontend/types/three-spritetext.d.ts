// Ambient types for libraries without bundled TypeScript declarations

// three-spritetext provides a default export class
// with constructor(text?: string, parameters?: any)
// It extends THREE.Sprite at runtime, but we keep it as any-compatible.

declare module 'three-spritetext' {
	const SpriteText: any;
	export default SpriteText;
}
