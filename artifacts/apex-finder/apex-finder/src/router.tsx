import { Layout } from "@/components/layout";
import { Route, Switch, Redirect, useSearch } from "wouter";
import Dashboard from "@/pages/dashboard";
import GraphViewer from "@/pages/graph";
import EntityLedger from "@/pages/entities";
import ApexProfile from "@/pages/profile";
import FieldManual from "@/pages/manual";
import DeepSearch from "@/pages/deep-search";
import Improvements from "@/pages/improvements";
import DataSources from "@/pages/data-sources";
import Duplicates from "@/pages/duplicates";
import OsintToolsDirectory from "@/pages/osint-tools";
import BackgroundJobs from "@/pages/jobs";
import IntelligenceReactorPage from "@/pages/reactor";
import IntelTerminal from "@/pages/research";
import NotFound from "@/pages/not-found";
import SystemStatusPage from "@/pages/status";

export default function AppRouter() {
  return (
    <Layout>
      <Switch>
        {/* ── Primary routes ── */}
        <Route path="/" component={Dashboard} />
        <Route path="/search" component={DeepSearch} />
        <Route path="/profiles" component={EntityLedger} />
        <Route path="/network" component={GraphViewer} />
        <Route path="/jobs" component={BackgroundJobs} />
        <Route path="/reactor" component={IntelligenceReactorPage} />
        <Route path="/research" component={IntelTerminal} />
        <Route path="/manual" component={FieldManual} />
        <Route path="/profile/:id" component={ApexProfile} />

        {/* ── Tools & Admin pages ── */}
        <Route path="/improvements" component={Improvements} />
        <Route path="/data-sources" component={DataSources} />
        <Route path="/duplicates" component={Duplicates} />
        <Route path="/osint-tools" component={OsintToolsDirectory} />
        <Route path="/status" component={SystemStatusPage} />

        {/* ── Legacy route aliases ── */}
        <Route path="/entities">{() => <Redirect to="/profiles" />}</Route>
        <Route path="/graph">{() => { const s = useSearch(); return <Redirect to={`/network${s ? `?${s}` : ""}`} />; }}</Route>
        <Route path="/deep-search">{() => <Redirect to="/search" />}</Route>
        <Route path="/ledger">{() => <Redirect to="/profiles" />}</Route>

        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}
