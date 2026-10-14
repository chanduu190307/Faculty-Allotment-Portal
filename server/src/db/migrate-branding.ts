import { getDatabase } from './connection';

export function migrateBranding(): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    // 1. Update settings
    db.prepare('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?')
      .run('Institution Name', now, 'college_name');

    db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, description, updated_at)
      VALUES (?, ?, ?, ?)
    `).run('institution_name', 'Institution Name', 'Configurable Institution Name', now);

    // 2. Neutralize email domain and clear phone numbers
    db.prepare(`
      UPDATE faculty 
      SET email = replace(email, '@apextech.edu', '@institution.edu'),
          phone = NULL 
      WHERE email LIKE '%@apextech.edu'
    `).run();

    // 3. Neutralize room names
    db.prepare(`UPDATE rooms SET name = 'Room ' || id`).run();
    db.prepare(`UPDATE rooms SET building = 'Block A' WHERE building LIKE 'Block A%'`).run();
    db.prepare(`UPDATE rooms SET building = 'Block B' WHERE building LIKE 'Block B%'`).run();
    db.prepare(`UPDATE rooms SET building = 'Block C' WHERE building LIKE 'Block C%'`).run();
    db.prepare(`UPDATE rooms SET building = 'Block D' WHERE building LIKE 'Block D%'`).run();
  });

  tx();
  console.log('[Migration] Database branding safely updated to neutral.');
}

if (require.main === module) {
  migrateBranding();
}
