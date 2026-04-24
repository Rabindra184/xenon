import * as React from 'react';
import './table.css';

export const Table: React.FC<React.HTMLAttributes<HTMLTableElement>> = ({
  className,
  ...rest
}) => <table className={`tbl${className ? ' ' + className : ''}`} {...rest} />;

export const THead: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = (p) => (
  <thead {...p} />
);
export const TBody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = (p) => (
  <tbody {...p} />
);
export const TR: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = (p) => <tr {...p} />;
export const TH: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = (p) => <th {...p} />;
export const TD: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = (p) => <td {...p} />;
