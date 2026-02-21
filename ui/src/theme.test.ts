import { describe, it, expect } from 'vitest';
import { colors, statusColors, baseStyles } from './theme';

describe('theme', () => {
  describe('colors', () => {
    it('has expected Catppuccin Mocha palette values', () => {
      expect(colors.base).toBe('#1e1e2e');
      expect(colors.text).toBe('#cdd6f4');
      expect(colors.blue).toBe('#89b4fa');
      expect(colors.green).toBe('#a6e3a1');
      expect(colors.red).toBe('#f38ba8');
      expect(colors.yellow).toBe('#f9e2af');
    });
  });

  describe('statusColors', () => {
    it('has expected agent status keys', () => {
      expect(statusColors.idle).toBe(colors.blue);
      expect(statusColors.active).toBe(colors.green);
      expect(statusColors.working).toBe(colors.green);
      expect(statusColors.stopped).toBe(colors.overlay0);
      expect(statusColors.error).toBe(colors.red);
    });

    it('has expected task status keys', () => {
      expect(statusColors.pending).toBe(colors.yellow);
      expect(statusColors.assigned).toBe(colors.blue);
      expect(statusColors.in_progress).toBe(colors.green);
      expect(statusColors.completed).toBe(colors.teal);
      expect(statusColors.failed).toBe(colors.red);
      expect(statusColors.canceled).toBe(colors.overlay0);
    });

    it('has project status keys', () => {
      expect(statusColors.archived).toBe(colors.overlay0);
    });
  });

  describe('baseStyles', () => {
    it('has container styles using theme colors', () => {
      expect(baseStyles.container.backgroundColor).toBe(colors.base);
      expect(baseStyles.container.color).toBe(colors.text);
    });

    it('has card styles', () => {
      expect(baseStyles.card.backgroundColor).toBe(colors.surface0);
      expect(baseStyles.card.borderRadius).toBe('8px');
    });

    it('has button variants', () => {
      expect(baseStyles.button.primary.backgroundColor).toBe(colors.blue);
      expect(baseStyles.button.secondary.backgroundColor).toBe(colors.surface1);
      expect(baseStyles.button.danger.backgroundColor).toBe(colors.red);
    });
  });
});
