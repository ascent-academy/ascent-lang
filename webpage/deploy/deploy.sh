scp -r ./webpage/* podlomar@ascent-lang.org:/var/www/ascent-lang.org
ssh podlomar@ascent-lang.org "chmod 755 /var/www/ascent-lang.org && chmod 644 /var/www/ascent-lang.org/*"
