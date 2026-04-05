/**
 * Global style utilities — used by editor-core/components/Styles.ts
 * Adapted from Outline's styles module.
 */
import type { DefaultTheme } from "styled-components";

export const breakpoints = {
  mobile: 0,
  mobileLarge: 460,
  tablet: 640,
  desktop: 1025,
  desktopLarge: 1600,
};

/**
 * Hover media query helper for styled-components.
 * On touch devices, :hover sticks after tap. This wraps hover styles
 * in a media query that only applies on devices with fine pointers.
 */
export function hover(css: string): string {
  return `
    @media (hover: hover) and (pointer: fine) {
      &:hover {
        ${css}
      }
    }
  `;
}

/**
 * Theme accessor for styled-components template literals.
 * Usage: `color: ${s("text")};` → reads props.theme.text
 */
export function s(key: keyof DefaultTheme) {
  return (props: { theme: DefaultTheme }) => props.theme[key];
}
