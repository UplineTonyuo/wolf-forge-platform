import {
  adjustCompanyBalanceSchema,
} from "../domain/wallets/schema";
import {
  parseInput,
  uuidSchema,
} from "../domain/shared";
import {
  CompanyWalletRepository,
} from "../repositories/company-wallet-repository";
import {
  requireVerifiedActor,
  type ServiceDependencies,
  type UserMutationActor,
} from "./mutation-context";

export class CompanyWalletService {
  constructor(
    private readonly dependencies:
      ServiceDependencies<CompanyWalletRepository>,
  ) {}

  getForCompany(
    companyId: unknown,
  ) {
    return this.dependencies.repository.getForCompany(
      parseInput(
        uuidSchema,
        companyId,
      ),
    );
  }

  listRecent(
    limit = 10,
  ) {
    const safeLimit =
      Number.isInteger(limit)
        ? Math.min(
            Math.max(limit, 1),
            50,
          )
        : 10;

    return this.dependencies.repository.listRecent(
      safeLimit,
    );
  }

  listMyHistory() {
    return this.dependencies.repository.listMyHistory();
  }

  async adjust(
    input: unknown,
    actor: UserMutationActor,
  ) {
    requireVerifiedActor(actor);

    return this.dependencies.repository.adjust(
      parseInput(
        adjustCompanyBalanceSchema,
        input,
      ),
    );
  }
}
