/** The traveller asked the system for less motion: no smooth scrolling, no animated map flights. */
export const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** `behavior` for scrollIntoView / scrollTo: smooth unless reduced motion is on. */
export const scrollBehavior = (): ScrollBehavior => (reducedMotion() ? 'auto' : 'smooth');
