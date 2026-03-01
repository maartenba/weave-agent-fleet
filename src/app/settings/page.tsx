"use client";

import { Header } from "@/components/layout/header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SkillsTab } from "@/components/settings/skills-tab";
import { AgentsTab } from "@/components/settings/agents-tab";
import { AboutTab } from "@/components/settings/about-tab";

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-full">
      <Header title="Settings" subtitle="Manage skills, agents, and configuration" />
      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="skills">
          <TabsList variant="line">
            <TabsTrigger value="skills">Skills</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>
          <TabsContent value="skills" className="mt-4">
            <SkillsTab />
          </TabsContent>
          <TabsContent value="agents" className="mt-4">
            <AgentsTab />
          </TabsContent>
          <TabsContent value="about" className="mt-4">
            <AboutTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
