import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('vitest infrastructure sanity', () => {
  it('renders a simple element', () => {
    render(<button>hello</button>);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });
});
