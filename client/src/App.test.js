import { render, screen } from '@testing-library/react';
import App from './App';

test('renders Job Matchmaker header', () => {
  render(<App />);
  const headerElement = screen.getByText(/Job Matchmaker/i);
  expect(headerElement).toBeInTheDocument();
});
