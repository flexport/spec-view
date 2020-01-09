# typed: true
# TEAM: backend_infra

module SpecView
  # Convenience methods available both to spec view classes and instances
  module SpecViewHelpers
    delegate :driver, :document, to: :page
    delegate :browser, to: :driver
    delegate :synchronize, to: :document
    def page
      Capybara.current_session
    end

    # TODO: These probably don't need to be on the classes since delegation
    # happens at the instance level
    #
    # Helper for disabling method_missing delegation in internal methods. This
    # prevents programming errors within the base SpecView implementations from
    # getting out of hand.
    def no_delegation
      @no_delegation ||= 0
      @no_delegation += 1
      yield
    ensure
      @no_delegation -= 1
    end

    def delegation_disabled
      @no_delegation.nil? || @no_delegation > 0
    end
  end
end
