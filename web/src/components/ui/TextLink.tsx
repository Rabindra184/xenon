import * as React from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cn } from '../../lib/utils';
import './text-link.css';

/**
 * A link to another page within the text of a page: accent, since it is
 * something to act on, underlined on hover. The focus ring is the global one.
 */
export const TextLink: React.FC<LinkProps> = ({ className, ...props }) => (
  <Link className={cn('text-link', className)} {...props} />
);
