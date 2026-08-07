import React from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';

// iOS 26 — native liquid glass tabs
function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
        <Label>Targets</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="mcts">
        <Icon sf={{ default: 'terminal', selected: 'terminal.fill' }} />
        <Label>MCTS</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="approach">
        <Icon sf={{ default: 'arrow.triangle.branch', selected: 'arrow.triangle.branch' }} />
        <Label>Evidence Path</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="connections">
        <Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
        <Label>Connections</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="manual">
        <Icon sf={{ default: 'book.pages', selected: 'book.pages.fill' }} />
        <Label>Manual</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

// Older iOS / Android / web — classic tab bar with brand colors
function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: isIOS ? 'transparent' : colors.card,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={80}
              tint={isDark ? 'dark' : 'dark'}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.card }]} />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Targets',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person.2" tintColor={color} size={22} />
            ) : (
              <Feather name="users" size={20} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="mcts"
        options={{
          title: 'MCTS',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="terminal" tintColor={color} size={22} />
            ) : (
              <Feather name="activity" size={20} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="approach"
        options={{
          title: 'Evidence Path',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="arrow.triangle.branch" tintColor={color} size={22} />
            ) : (
              <Feather name="map" size={20} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="connections"
        options={{
          title: 'Connections',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person.2" tintColor={color} size={22} />
            ) : (
              <Feather name="share-2" size={20} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="manual"
        options={{
          title: 'Manual',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="book.pages" tintColor={color} size={22} />
            ) : (
              <Feather name="book-open" size={20} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
