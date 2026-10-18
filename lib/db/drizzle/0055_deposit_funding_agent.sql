ALTER TABLE "payment_requests" ADD COLUMN "funding_agent_id" text CONSTRAINT "payment_requests_funding_agent_id_network_nodes_id_fk" REFERENCES "network_nodes"("id");
