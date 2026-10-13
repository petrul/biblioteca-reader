import React from 'react';
import { Search, X } from 'lucide-react';

interface SearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'className'> {
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name; rendered visually hidden. */
  label: string;
  /** Classes for the input itself (colors, size); padding for the icons is added here. */
  inputClassName: string;
  /** Classes for the wrapper (width, flex). */
  className?: string;
  /** Show a clear (x) button while there is text. */
  clearable?: boolean;
  /** Icon color classes. */
  iconClassName?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}

/**
 * The reader's one search box: magnifier, accessible label and optional
 * clear button. Used by the catalog filters, the table-of-contents sidebar
 * and the collections panel, so they look and behave alike.
 */
export const SearchField: React.FC<SearchFieldProps> = ({
  value,
  onValueChange,
  label,
  inputClassName,
  className = '',
  clearable = false,
  iconClassName = 'text-white/60',
  inputRef,
  id,
  ...inputProps
}) => (
  <div className={`relative ${className}`}>
    <label htmlFor={id} className="sr-only">{label}</label>
    <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none ${iconClassName}`} aria-hidden="true" />
    <input
      {...inputProps}
      id={id}
      ref={inputRef}
      type="search"
      value={value}
      onChange={event => onValueChange(event.target.value)}
      className={`w-full pl-9 ${clearable ? 'pr-9 [&::-webkit-search-cancel-button]:appearance-none' : 'pr-3'} ${inputClassName}`}
    />
    {clearable && value && (
      <button
        type="button"
        aria-label="Clear search"
        onClick={() => onValueChange('')}
        className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:text-white cursor-pointer ${iconClassName}`}
      >
        <X className="w-4 h-4" />
      </button>
    )}
  </div>
);
