import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useLang } from '../src/lang';
import { roleName } from '../src/roles';
import { useSession } from '../src/session';
import { brand } from '../src/theme';
import { Button, Choices, form } from '../src/ui/Form';
import { PushSettings } from '../src/ui/PushSettings';

export default function SettingsScreen() {
  const router = useRouter();
  const { lang, setLang, t } = useLang();
  const { session, signOut } = useSession();
  const [leaving, setLeaving] = useState(false);

  return (
    <ScrollView style={form.screen} contentContainerStyle={form.content}>
      <View style={form.card}>
        <Text style={form.strong}>{session?.name}</Text>
        <Text style={form.text}>{roleName(session?.role, t)}</Text>
        <Text style={form.faint}>{session?.institution}</Text>
      </View>

      <Text style={form.strong}>{t('Bahasa', 'Language')}</Text>
      <Choices
        value={lang}
        onChange={setLang}
        options={[
          { value: 'ms', label: 'Bahasa Melayu' },
          { value: 'en', label: 'English' },
        ]}
      />

      <PushSettings />

      <Text style={form.strong}>{t('Akaun', 'Account')}</Text>
      <Button label={t('Tukar kata laluan', 'Change password')} quiet onPress={() => router.push('/password')} />
      {(session?.role === 'admin' || session?.role === 'auditor') && (
        <Button label={t('Pengguna', 'Users')} quiet onPress={() => router.push('/people')} />
      )}

      {leaving ? (
        <View style={form.card}>
          <Text style={form.text}>{t('Log keluar daripada telefon ini?', 'Sign out of this phone?')}</Text>
          <Button label={t('Ya, log keluar', 'Yes, sign out')} danger onPress={signOut} />
          <Button label={t('Batal', 'Cancel')} quiet onPress={() => setLeaving(false)} />
        </View>
      ) : (
        <Button label={t('Log keluar', 'Sign out')} danger onPress={() => setLeaving(true)} />
      )}
      <Text style={form.faint}>
        {brand.copyright} · {brand.version}
      </Text>
    </ScrollView>
  );
}
