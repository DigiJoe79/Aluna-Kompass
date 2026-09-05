import { monotonicFactory } from 'ulid';

const generate = monotonicFactory();

export const ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const newId = (): string => generate();
