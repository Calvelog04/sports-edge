"use client";

import { useId } from "react";

export function BoardSearch(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Optional count of rows matching the current query. */
  matchCount?: number | null;
  totalCount?: number | null;
}) {
  const id = useId();
  const placeholder = props.placeholder ?? "Search teams or players…";
  const showCount =
    Boolean(props.value.trim()) &&
    props.matchCount != null &&
    props.totalCount != null;

  return (
    <div className="board-search">
      <label className="board-search-label" htmlFor={id}>
        Search
      </label>
      <div className="board-search-field">
        <input
          id={id}
          type="search"
          className="board-search-input"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
        />
        {props.value.trim() ? (
          <button
            type="button"
            className="board-search-clear"
            onClick={() => props.onChange("")}
            aria-label="Clear search"
          >
            Clear
          </button>
        ) : null}
      </div>
      {showCount ? (
        <span className="board-search-count">
          {props.matchCount} of {props.totalCount}
        </span>
      ) : null}
    </div>
  );
}
